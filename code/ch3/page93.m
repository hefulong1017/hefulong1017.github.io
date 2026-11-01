for ii=1:4
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
M=10*2^(ii-1);
N=200*4^(ii-1);
h = (x2-x1)/M; dt = (t2-t1)/N;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u=zeros(M+1,N+1);
u(:,1)=exp(x);
u(1,:)=exp(t);
u(M+1,:)=exp(1+t);
r=dt/(h^2);
row1=zeros(M-1,1);
row1(1,1)=1-2*r;row1(2,1)=r;
A=toeplitz(row1);
H=zeros(M-1,1);
for k=1:N
H(1,1)=r*u(1,k);
H(M-1,1)=r*u(M+1,k);
u(2:M,k+1)=A*u(2:M,k)+H;
end
F=zeros(M+1,N+1);
for i=1:M+1
    for j=1:N+1
        F(i,j)=exp(x(i)+t(j));
    end
end
error=abs(u-F);
Error1=abs(u(:,N+1)-F(:,N+1));
maxerror(ii)=max(max(error));
disp(maxerror(ii));
figure(1)
plot(x,Error1,'k-.')
hold on
end
for j=1:3
    ord=maxerror(j)/maxerror(j+1);
    disp(ord);
end


