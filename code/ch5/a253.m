for ii=1:6
    xa=0;xb=1;ya=0;yb=1;ta=0;tb=1;
     M=10*2^(ii-1);
    N=10*2^(ii-2);
    dt=(tb-ta)/2*N;
    h=(xb-xa)/M;
    x=xa:h:xb;x=x';
    y=ya:h:yb;y=y';
    t=ta:dt:tb;t=t';
    u=zeros(M+1,M+1,2*N+1);
    for i=1:M+1
        for j=1:M+1
            for k=1:2*N+1
    u(i,j,1)=exp(1/2*(x(i)+y(j)));
    u(1,j,k)=exp(1/2*y(j)-t(k));u(M+1,j,k)=exp(1/2*(1+y(j))-t(k));
    u(i,1,k)=exp(1/2*x(i)-t(k));u(i,M+1,k)=exp(1/2*(1+x(i))-t(k));
            end
        end
    end
    a=1;
r=a*dt/h^2;  
 I=eye(M-1);
  B1=(1+r)*I;
C1=(-r/2)*I; 
O=zeros(M-1);
A1 = kron(diag(ones(1,M-2),1) + diag(ones(1,M-2),-1),C1)+ kron(diag(ones(1,M-1)),B1);                     
                     
row1=zeros(M-1,1);
row1(1,1)=1-r;row1(2,1)=r/2;
B2=toeplitz(row1);
  A2 = kron(diag(ones(1,M-2),1) + diag(ones(1,M-2),-1),O)+ kron(diag(ones(1,M-1)),B2);                 
row2=zeros(M-1,1);
row2(1,1)=1+r;row2(2,1)=-r/2;
B3=toeplitz(row2);

 A3 = kron(diag(ones(1,M-2),1) + diag(ones(1,M-2),-1),O)+ kron(diag(ones(1,M-1)),B3);
B4=(1-r)*I;

C4=r/2*I;

A4 = kron(diag(ones(1,M-2),1) + diag(ones(1,M-2),-1),C4)+ kron(diag(ones(1,M-1)),B4);
for k=1:N
Fhalf1=zeros(M-1,M-1);
Fhalf1(1,1:M-1)=u(1,2:M,2*k);
Fhalf1(M-1,1:M-1)=u(M+1,2:M,2*k);
F1=reshape(Fhalf1,(M-1)*(M-1),1);
Fk=zeros(M-1,M-1);
Fk(1:M-1,1)=u(2:M,1,2*k+1);
Fk(1:M-1,M-1)=u(2:M,M+1,2*k+1);
u(2:M,2:M,2*k)=A1/(A2*u(2:M,2:M,2*k-1)+r/2*Fhalf1+r/2*Fk);
u(2:M,2:M,2*k+1)=A3/(A4*u(2:M,2:M,2*k)+r/2*Fhalf1+r/2*Fk);
end
F=zeros(M+1,M+1,N+1);
for i=1:M+1
  for  j=1:M+1
      for k=1:2*N+1
    F(i,j,k)=exp(1/2*(x(i))+y(j))-t(k);
end
  end
      end
error = abs(F-u);
MaxErr(i) = max(max(error));
end
figure(1)
mesh(x,y,error(1:m+1,1:n+1));
figure(2)
mesh(x,y,F(1:m+1,1:n+1));
disp(MaxErr)
for i=1:3
ord=MaxErr(i)/MaxErr(i+1);
disp(ord);
end


