MaxErr=zeros(4,1);
for i=1:4
    xa=0;xb=2;ya=0;yb=1;
    m=4*2^i;
    n=4*2^i;
h1=(xb-xa)/m;
h2=(yb-ya)/n;
x=xa:h1:xb;x=x';
y=ya:h2:yb;y=y';
u=zeros(m+1,n+1);
u(1,:)=sin(pi*y);
u(m+1,:)=(exp(2))*sin(pi*y);
u(:,1)=0;u(:,n+1)=0;
row1=zeros(m-1,1);
row1(1,1)=2*(1/(h1^2)+1/(h2^2));row1(2,1)=-1/h1^2;
C=toeplitz(row1);
I=speye(m-1,m-1);
D=(-1/h2^2)*I;
A = kron(diag(ones(1,n-2),1) + diag(ones(1,n-2),-1),D)+ kron(diag(ones(1,n-1)),C);
f=zeros(m-1,1);
for j = 1:n-1
    f(1,j) = F2(x(2),y(j+1))+(1/h1^2)*u(1,j+1);
    for k = 2:m-2
        f(k,j) = F2(x(k+1),y(j+1));
    end
    f(m-1,j) = F2(x(m),y(j+1))+(1/h1^2)*u(m+1,j+1);
end
f(:,1) = f(:,1) - D*u(2:m,1);
f(:,n-1) = f(:,n-1) - D*u(2:m,n+1);
H = reshape(f,(m-1)*(n-1),1);
U1=A\H;
U2=reshape(U1,m-1,n-1);
u(2:m,2:n)=U2;
F=zeros(m+1,n+1);
for k=1:m+1
  for  j=1:n+1
    F(k,j)=exp(x(k))*sin(pi*y(j));
  end
end
error = abs(F-u);
MaxErr(i) = max(max(error));
figure(1)
mesh(x,y,error(1:m+1,1:n+1));
figure(2)
mesh(x,y,F(1:m+1,1:n+1));
end
disp(MaxErr)
for i=1:3
ord=MaxErr(i)/MaxErr(i+1);
disp(ord);
end