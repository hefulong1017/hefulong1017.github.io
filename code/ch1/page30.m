for ii=1:11
M=10*(2^(ii-1));
xa=0;xb=pi;
h=(xb-xa)/M;
x=xa:h:xb;x=x';
u=zeros(M+1,1);
u(1,1)=0;
u(M+1,1)=0;
row1=zeros(M-1,1);
row1(1,1)=5/6+2/(h^2);row1(2,1)=1/12-1/(h^2);
A=toeplitz(row1);
H=zeros(M-1,1);
H(1) = (5/6)*F1(x(2))+(1/12)*F1(x(1))+(1/12)*F1(x(3));
H(M-1) =  (5/6)*F1(x(M))+(1/12)*F1(x(M-1))+(1/12)*F1(x(M+1));
H(2:M-2,1) = (5/6)*F1(x(3:M-1))+(1/12)*F1(x(3:M-1))+(1/12)*F1(x(3:M-1));
u(2:M,1)=A\(H);
F=zeros(M,1);
for j=1:M+1
    F(j)=exp(x(j))*sin(x(j));
end
error=abs(u-F);
MaxErr(ii) = max((error()));
disp(['最大误差: ', num2str(MaxErr(ii))]);
figure(1)
plot(x,u,'o--')
hold on
figure(2)
plot(x,error,'--')
hold on
end
for j=2:10
    ord=MaxErr(j-1)/MaxErr(j+1);
    disp(ord)
end